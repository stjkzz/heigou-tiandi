# 黑狗天地后端服务

## 部署步骤

### 1. 创建腾讯云COS
- 登录腾讯云控制台
- 创建COS存储桶
- 获取 SecretId 和 SecretKey

### 2. 部署到 Render/Vercel/其他平台

**Render部署：**
1. 把代码推送到GitHub
2. 在Render创建Web Service
3. 连接GitHub仓库
4. 设置环境变量（见下方）
5. 部署

**环境变量：**
```
COS_SECRET_ID=你的SecretId
COS_SECRET_KEY=你的SecretKey
COS_BUCKET=你的Bucket名称
COS_REGION=你的Region（如ap-guangzhou）
```

### 3. 前端配置
部署完成后，把后端API地址告诉前端开发者。

## 本地开发

```bash
# 安装依赖
npm install

# 设置环境变量（Windows PowerShell）
$env:COS_SECRET_ID="你的SecretId"
$env:COS_SECRET_KEY="你的SecretKey"
$env:COS_BUCKET="你的Bucket"
$env:COS_REGION="ap-guangzhou"

# 启动服务
npm run dev
```

## API接口

- `GET /api/files` - 获取文件列表
- `POST /api/upload` - 上传文件（multipart/form-data）
  - 参数：grade（高一/高二/高三）、type（试卷/心得）、file（文件）
- `GET /api/download?key=xxx` - 获取下载链接
