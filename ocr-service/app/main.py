from __future__ import annotations

import hmac
import time
from collections import defaultdict, deque

from fastapi import Depends, FastAPI, File, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel

from .extractors import DocumentType, extract
from .settings import Settings, settings

app = FastAPI(title="Skyline Local OCR", docs_url=None, redoc_url=None)
_requests: dict[str, deque[float]] = defaultdict(deque)
ALLOWED_MIME = {"application/pdf", "image/jpeg", "image/png"}


def authorised(request: Request, x_ocr_service_key: str = Header(default="")) -> Settings:
    config = settings()
    if not hmac.compare_digest(x_ocr_service_key, config.shared_secret):
        raise HTTPException(401, "Unauthorised OCR request")
    client = request.client.host if request.client else "unknown"
    now, recent = time.monotonic(), _requests[client]
    while recent and now - recent[0] > 60: recent.popleft()
    if len(recent) >= config.rate_limit_per_minute:
        raise HTTPException(429, "OCR rate limit exceeded")
    recent.append(now)
    return config


class ExtractionResponse(BaseModel):
    document_type: str
    fields: list[dict[str, str | None]]
    warnings: list[str]
    engine: str


def ocr_text(content: bytes, language: str) -> str:
    """Lazy Paddle import so deterministic tests do not require GPU/model packages."""
    try:
        from paddleocr import PaddleOCR  # type: ignore
    except ImportError as exc:
        raise HTTPException(503, "PaddleOCR is not installed in this service environment") from exc
    # PaddleOCR chooses the language recognition model; models remain local after download.
    engine = PaddleOCR(lang=language)
    result = engine.predict(content)
    return "\n".join(str(item) for item in result)


@app.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok", "engine": "paddleocr-lazy"}


@app.post("/v1/extract", response_model=ExtractionResponse)
async def extract_document(
    request: Request,
    file: UploadFile = File(...),
    document_type: DocumentType = "other",
    language: str = "en",
    config: Settings = Depends(authorised),
) -> ExtractionResponse:
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(415, "Only PDF, JPEG and PNG documents are accepted")
    content = await file.read(config.max_bytes + 1)
    if not content or len(content) > config.max_bytes:
        raise HTTPException(413, "Document must be between 1 byte and 10 MB")
    if file.content_type == "application/pdf" and not content.startswith(b"%PDF-"):
        raise HTTPException(415, "Uploaded PDF does not have a PDF signature")
    if file.content_type == "image/png" and not content.startswith(b"\x89PNG"):
        raise HTTPException(415, "Uploaded PNG does not have a PNG signature")
    if file.content_type == "image/jpeg" and not content.startswith(b"\xff\xd8\xff"):
        raise HTTPException(415, "Uploaded JPEG does not have a JPEG signature")
    text = ocr_text(content, language)
    result = extract(text, document_type)
    return ExtractionResponse(document_type=document_type, fields=[field.__dict__ for field in result.fields], warnings=result.warnings, engine="paddleocr")
