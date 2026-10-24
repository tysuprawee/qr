"""Private GPU adapter for Meta SAM 3D Objects. No demo or synthetic fallback."""
import asyncio
import io
import os
import secrets
import sys
import warnings
from pathlib import Path

import numpy as np
from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError

app = FastAPI(docs_url=None, redoc_url=None)
lock = asyncio.Lock()
model = None
MAX_BYTES = 8 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 24_000_000
warnings.simplefilter("error", Image.DecompressionBombWarning)


def authenticate(authorization: str | None):
    secret = os.environ.get("SAM_WORKER_TOKEN", "")
    if len(secret) < 32:
        raise HTTPException(503, "Worker authentication is not configured.")
    if not authorization or not secrets.compare_digest(authorization, "Bearer " + secret):
        raise HTTPException(401, "Unauthorized")


def reconstruct_sync(image_bytes: bytes, mask_bytes: bytes) -> bytes:
    global model
    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            if source.format not in ("JPEG", "PNG", "WEBP"):
                raise ValueError("Unsupported image")
            image = np.array(source.convert("RGB"))
        with Image.open(io.BytesIO(mask_bytes)) as source:
            if source.format != "PNG":
                raise ValueError("Mask must be PNG")
            mask = np.array(source.convert("L")) >= 128
        if image.shape[:2] != mask.shape or not mask.any():
            raise ValueError("Mask must match the image dimensions and select an object")
    except (ValueError, UnidentifiedImageError, Image.DecompressionBombWarning, Image.DecompressionBombError) as error:
        raise HTTPException(422, str(error)) from error
    if model is None:
        root = Path(os.environ["SAM3D_ROOT"]).resolve()
        sys.path.insert(0, str(root / "notebook"))
        sys.path.insert(0, str(root))
        from inference import Inference
        model = Inference(str(root / "checkpoints" / "hf" / "pipeline.yaml"), compile=False)
    output = model(image, mask, seed=42)
    mesh = output.get("glb")
    if mesh is None:
        raise HTTPException(502, "SAM produced no mesh. Gaussian-only output is not importable as furniture.")
    # Upstream to_glb already converts z-up to y-up. Do not apply that rotation twice.
    # Its scale is estimated; the web editor requires explicit measured dimensions.
    result = mesh.export(file_type="glb")
    if not isinstance(result, bytes) or result[:4] != b"glTF" or len(result) > 32 * 1024 * 1024:
        raise HTTPException(502, "SAM returned an invalid or oversized mesh")
    return result


@app.post("/reconstruct")
async def reconstruct(image: UploadFile = File(...), mask: UploadFile = File(...), authorization: str | None = Header(default=None)):
    authenticate(authorization)
    if lock.locked():
        raise HTTPException(409, "GPU worker is busy")
    async with lock:
        try:
            image_bytes = await image.read(MAX_BYTES + 1)
            mask_bytes = await mask.read(MAX_BYTES + 1)
            if len(image_bytes) > MAX_BYTES or len(mask_bytes) > MAX_BYTES:
                raise HTTPException(413, "Image or mask exceeds 8 MB")
            result = await asyncio.to_thread(reconstruct_sync, image_bytes, mask_bytes)
            return Response(result, media_type="model/gltf-binary", headers={"Cache-Control": "no-store"})
        except HTTPException:
            raise
        except Exception as error:
            # Return an actual failure; never manufacture a replacement mesh.
            raise HTTPException(503, "SAM inference failed. Check GPU installation and model weights on the worker.") from error
        finally:
            await image.close()
            await mask.close()
