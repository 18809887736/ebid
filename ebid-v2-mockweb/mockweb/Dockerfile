FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV FLASK_APP=app.py
EXPOSE 8080
# 不开 FLASK_DEBUG：热更新交给 compose watch 的 sync+restart，且避开 Werkzeug 交互调试器 RCE 入口
CMD ["flask", "run", "--host", "0.0.0.0", "--port", "8080"]
