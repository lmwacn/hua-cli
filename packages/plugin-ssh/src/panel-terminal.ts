import { IncomingMessage, Server } from "node:http";
import { Client, ClientChannel } from "ssh2";
import { WebSocket, WebSocketServer } from "ws";
import { buildConnectConfig } from "./client";
import { SshProfile } from "./types";

function terminalSize(input: Record<string, unknown>) {
  const { cols, rows } = input;
  if (typeof cols !== "number" || !Number.isInteger(cols) || cols < 2 || cols > 500 ||
      typeof rows !== "number" || !Number.isInteger(rows) || rows < 2 || rows > 300) {
    return undefined;
  }
  return { cols, rows };
}

function attachTerminal(socket: WebSocket, resolveProfile: (name: string, version: string) => SshProfile) {
  const ssh = new Client();
  let channel: ClientChannel | undefined;
  let started = false;
  let ended = false;

  const sendStatus = (state: string, message?: string) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ state, message }));
  };
  const finish = (state: string, message?: string) => {
    if (ended) return;
    ended = true;
    sendStatus(state, message);
    socket.close();
    ssh.destroy();
  };
  const fail = (error: unknown) => finish("error", error instanceof Error ? error.message : String(error));
  const timer = setTimeout(() => finish("error", "终端连接超时。"), 25000);
  timer.unref();

  socket.on("close", () => {
    ended = true;
    clearTimeout(timer);
    ssh.destroy();
  });
  socket.on("error", fail);
  ssh.on("error", fail);
  ssh.on("close", () => finish("closed"));

  socket.on("message", (data, binary) => {
    if (ended) return;
    if (binary) {
      if (channel && !channel.destroyed && !channel.writableEnded) {
        if (channel.writableLength > 1024 * 1024) {
          finish("error", "终端输入积压，请重新连接。");
          return;
        }
        channel.write(data as Buffer);
      }
      return;
    }

    try {
      const input = JSON.parse(data.toString()) as Record<string, unknown>;
      const size = terminalSize(input);
      if (!size) throw new Error("终端尺寸无效。");
      if (input.type === "resize") {
        channel?.setWindow(size.rows, size.cols, 0, 0);
        return;
      }
      if (started || input.type !== "start" || typeof input.name !== "string" || typeof input.version !== "string") {
        throw new Error("终端请求无效。");
      }

      started = true;
      ssh.once("ready", () => {
        if (ended) return;
        ssh.shell({ ...size, term: "xterm-256color" }, (error, stream) => {
          if (error) return fail(error);
          if (ended) return stream.destroy();

          clearTimeout(timer);
          channel = stream;
          sendStatus("ready");
          const forward = (chunk: Buffer) => {
            if (socket.readyState !== WebSocket.OPEN) return;
            if (socket.bufferedAmount > 4 * 1024 * 1024) {
              finish("error", "终端输出积压，请重新连接。");
              return;
            }
            socket.send(chunk, { binary: true });
          };
          stream.on("data", forward);
          stream.stderr.on("data", forward);
          stream.on("error", fail);
          stream.on("close", () => finish("closed"));
        });
      });
      ssh.connect({ ...buildConnectConfig(resolveProfile(input.name, input.version)), keepaliveInterval: 15000 });
    } catch (error) {
      fail(error);
    }
  });
}

export function registerPanelTerminal(
  server: Server,
  getHost: () => string,
  token: string,
  resolveProfile: (name: string, version: string) => SshProfile,
): void {
  const terminals = new WebSocketServer({
    noServer: true,
    maxPayload: 128 * 1024,
    handleProtocols: () => "hua-ssh",
  });
  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const host = getHost();
    const protocols = request.headers["sec-websocket-protocol"]?.split(",").map((value) => value.trim());
    if (request.url !== "/terminal" || request.headers.host !== host ||
        request.headers.origin !== `http://${host}` ||
        !protocols?.includes("hua-ssh") || !protocols.includes(token)) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
      return;
    }
    terminals.handleUpgrade(request, socket, head, (connection) => attachTerminal(connection, resolveProfile));
  });
}
