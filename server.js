const express = require('express');
const COS = require('cos-nodejs-sdk-v5');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// 启用CORS
app.use(cors());
app.use(express.json());

// 腾讯云COS配置（环境变量）
const cos = new COS({
    SecretId: process.env.COS_SECRET_ID,
    SecretKey: process.env.COS_SECRET_KEY
});

const BUCKET = process.env.COS_BUCKET;
const REGION = process.env.COS_REGION;

// 获取文件列表
app.get('/api/files', async (req, res) => {
    try {
        const result = await cos.getBucket({
            Bucket: BUCKET,
            Region: REGION,
            Prefix: '',
            MaxKeys: 1000
        });
        
        const files = result.Contents.map(item => {
            const parts = item.Key.split('/');
            if (parts.length < 3) return null;
            
            // 正确处理中文文件名
            const fileName = decodeURIComponent(parts[parts.length - 1]);
            return {
                name: fileName.replace(/^\d+_/, ''),
                cosKey: item.Key,
                cosUrl: `https://${BUCKET}.cos.${REGION}.myqcloud.com/${encodeURIComponent(item.Key)}`,
                category: parts[0] + '-' + parts[1],
                size: formatFileSize(item.Size),
                date: new Date(item.LastModified).toLocaleDateString('zh-CN'),
                grade: parts[0] === 'gaoyi' ? '高一' : parts[0] === 'gaoer' ? '高二' : '高三',
                type: parts[1] === 'xinde' ? '心得' : '试卷'
            };
        }).filter(f => f !== null);
        
        res.json({ success: true, files });
    } catch (error) {
        console.error('获取文件列表失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 上传文件
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        const { grade, type } = req.body;
        const file = req.file;
        
        if (!file) {
            return res.status(400).json({ success: false, error: '没有文件' });
        }
        
        const gradeKey = { '高一': 'gaoyi', '高二': 'gaoer', '高三': 'gaosan' }[grade];
        const typeKey = type === '心得' ? 'xinde' : 'shijuan';
        // 使用 Buffer 正确处理中文文件名
        const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const fileKey = `${gradeKey}/${typeKey}/${Date.now()}_${originalName}`;
        
        await cos.putObject({
            Bucket: BUCKET,
            Region: REGION,
            Key: fileKey,
            Body: file.buffer
        });
        
        res.json({ success: true, message: '上传成功' });
    } catch (error) {
        console.error('上传失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 获取下载URL
app.get('/api/download', async (req, res) => {
    try {
        const { key } = req.query;
        const url = `https://${BUCKET}.cos.${REGION}.myqcloud.com/${encodeURIComponent(key)}`;
        res.json({ success: true, url });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 静态文件服务
app.use(express.static('public'));

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
