# Skyline local OCR service

This service processes documents locally with PaddleOCR PP-OCRv5-compatible
PaddleOCR 3.x packages. It is deliberately **not wired into the React app yet**.
It accepts only a trusted backend/Edge-Function request authenticated with
`OCR_SERVICE_SHARED_SECRET`; it must never be called from browser code.

## Windows setup

Install Python 3.11 or 3.12, then from `ocr-service`:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
# Install PaddlePaddle CPU/GPU using the command for your hardware from
# https://www.paddlepaddle.org.cn/install/quick
python -m pip install -r requirements.txt
Copy-Item .env.example .env
python -m uvicorn app.main:app --host 127.0.0.1 --port 8090
python -m unittest discover -s tests -v
```

The initial model download is performed by PaddleOCR from its configured model
source. Pin or mirror approved model artefacts before production deployment.

## API boundary

`POST /v1/extract` takes a backend-provided file upload and document category.
The caller must send `X-OCR-Service-Key`; the service applies file-size/type
validation, per-IP rate limiting, and returns proposed values only. A future
Supabase Edge Function must: verify the user JWT, use RLS to authorise the
application/document, obtain the private object bytes, and call this endpoint.
No service secret or OCR URL belongs in `VITE_*` configuration.

Supported local OCR language models: English (`en`), Simplified Chinese
(`ch`), Traditional Chinese (`chinese_cht`) and Korean (`korean`). The service
does not translate or romanise addresses; it preserves original script.
