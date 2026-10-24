# 后备入口：公司电脑禁用 Docker/WSL 时，宿主机 python -m mockweb 裸跑（规格 §1 后备）
import os

from mockweb.app import app

app.run(host="127.0.0.1", port=int(os.environ.get("MOCK_PORT", "18080")))
