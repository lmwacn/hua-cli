class DigitalHumanError(RuntimeError):
    """可向 CLI 用户展示的可预期错误。"""


class ConfigurationError(DigitalHumanError):
    pass


class CredentialError(DigitalHumanError):
    pass


class ApiError(DigitalHumanError):
    def __init__(self, message: str, *, status: int | None = None, detail: object = None):
        super().__init__(message)
        self.status = status
        self.detail = detail
