"""
Modal deployment entry point.
Run: modal deploy modal_app.py
"""

import modal

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install_from_pyproject("pyproject.toml")
    .apt_install("libgl1-mesa-glx")  # PIL dependency
)

app = modal.App("wayfr-backend", image=image)


@app.function(
    secrets=[modal.Secret.from_name("wayfr-secrets")],
    gpu=modal.gpu.T4(),
    concurrency_limit=20,
    timeout=3600,
    keep_warm=1,  # 1 warm instance to avoid cold starts during demo
)
@modal.asgi_app()
def fastapi_app():
    from main import create_app

    return create_app()
