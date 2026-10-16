from dataclasses import dataclass
import os


@dataclass(frozen=True)
class Settings:
    shared_secret: str
    max_bytes: int
    rate_limit_per_minute: int


def settings() -> Settings:
    secret = os.environ.get("OCR_SERVICE_SHARED_SECRET", "")
    if len(secret) < 24:
        raise RuntimeError("OCR_SERVICE_SHARED_SECRET must be at least 24 characters.")
    return Settings(
        shared_secret=secret,
        max_bytes=int(os.environ.get("OCR_MAX_BYTES", str(10 * 1024 * 1024))),
        rate_limit_per_minute=int(os.environ.get("OCR_RATE_LIMIT_PER_MINUTE", "12")),
    )
