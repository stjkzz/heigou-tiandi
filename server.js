const express = require('express');
const COS = require('cos-nodejs-sdk-v5');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const WebSocket = require('ws');
const crypto = require('crypto');

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
            const rawFileName = decodeURIComponent(parts[parts.length - 1]);
            const fileName = rawFileName.replace(/^\d+_/, '');
            const grade = parts[0] === 'gaoyi' ? '高一' : parts[0] === 'gaoer' ? '高二' : '高三';
            const type = parts[1] === 'xinde' ? '心得' : '试卷';
            
            // 心得统一归类到 xinde，文件名前加年级
            const category = type === '心得' ? 'xinde' : parts[0] + '-' + parts[1];
            const displayName = type === '心得' ? `[${grade}] ${fileName}` : fileName;
            
            return {
                name: displayName,
                cosKey: item.Key,
                cosUrl: `https://${BUCKET}.cos.${REGION}.myqcloud.com/${encodeURIComponent(item.Key)}`,
                category: category,
                size: formatFileSize(item.Size),
                date: new Date(item.LastModified).toLocaleDateString('zh-CN'),
                grade: grade,
                type: type
            };
        }).filter(f => f !== null);
        
        res.json({ success: true, files });
    } catch (error) {
        console.error('获取文件列表失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 上传文件（需要密码验证）
app.post('/api/upload', upload.single('file'), async (req, res) => {
    try {
        const { grade, type, password } = req.body;
        const file = req.file;
        
        // 验证上传密码
        const correctPassword = process.env.DELETE_PASSWORD || 'mami';
        if (password !== correctPassword) {
            return res.status(403).json({ success: false, error: '上传密码错误' });
        }
        
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

// 获取下载URL（心得需要密码验证）
app.get('/api/download', async (req, res) => {
    try {
        const { key, password } = req.query;
        
        console.log('Download request - key:', key, 'password provided:', !!password);
        
        // 判断是否是心得文件
        if (key.includes('/xinde/')) {
            const correctPassword = process.env.DELETE_PASSWORD || 'mami';
            console.log('Xinde file detected, checking password...');
            if (password !== correctPassword) {
                console.log('Password incorrect');
                return res.status(403).json({ success: false, error: '密码错误' });
            }
            console.log('Password correct');
        }
        
        // 生成下载 URL（直接拼接，bucket 需要是公共读的）
        console.log('Generating URL for key:', key);
        
        // 只编码文件名部分，保留路径分隔符 /
        const keyParts = key.split('/');
        const encodedFileName = encodeURIComponent(keyParts[keyParts.length - 1]);
        keyParts[keyParts.length - 1] = encodedFileName;
        const encodedKey = keyParts.join('/');
        
        const url = `https://${BUCKET}.cos.${REGION}.myqcloud.com/${encodedKey}`;
        console.log('Generated URL:', url);
        
        res.json({ success: true, url: url });
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 删除文件（需要密码验证）
app.delete('/api/delete', async (req, res) => {
    try {
        const { key, password } = req.query;
        
        // 验证密码（从环境变量读取）
        const correctPassword = process.env.DELETE_PASSWORD || 'mami';
        if (password !== correctPassword) {
            return res.status(403).json({ success: false, error: '密码错误' });
        }
        
        await cos.deleteObject({
            Bucket: BUCKET,
            Region: REGION,
            Key: key
        });
        
        res.json({ success: true, message: '删除成功' });
    } catch (error) {
        console.error('删除失败:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 静态文件服务
app.use(express.static('public'));

// 讯飞星火对话接口 - 使用 Spark Lite HTTP API
app.post('/api/chat', async (req, res) => {
    try {
        const { message, history = [] } = req.body;
        
        const apiPassword = process.env.SPARK_API_PASSWORD || process.env.SPARK_API_KEY;
        
        console.log('Chat request received:', { apiPassword: apiPassword ? 'set' : 'missing' });
        
        if (!apiPassword) {
            return res.status(500).json({ success: false, error: '星火API配置缺失，请设置 SPARK_API_PASSWORD 或 SPARK_API_KEY' });
        }
        
        // 构建 messages
        const messages = [
            { role: 'system', content: 'You are a helpful English teacher. Help the user practice English. If they write in Chinese, explain in Chinese but encourage them to use English. Correct their grammar mistakes gently.' },
            ...history,
            { role: 'user', content: message }
        ];
        
        // 使用 Spark Lite HTTP API
        const response = await fetch('https://spark-api-open.xf-yun.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiPassword}`
            },
            body: JSON.stringify({
                model: 'lite',
                messages: messages,
                temperature: 0.7,
                max_tokens: 2048
            })
        });
        
        const data = await response.json();
        console.log('Spark API response:', JSON.stringify(data).substring(0, 200));
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            res.json({ success: true, reply: data.choices[0].message.content });
        } else if (data.error) {
            console.error('Spark API error:', data.error);
            res.status(500).json({ success: false, error: data.error.message || '星火API错误' });
        } else {
            res.status(500).json({ success: false, error: '未知错误' });
        }
        
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// 测试星火配置
app.get('/api/test-spark', (req, res) => {
    const appid = process.env.SPARK_APPID;
    const apiKey = process.env.SPARK_API_KEY;
    const apiSecret = process.env.SPARK_API_SECRET;
    const apiPassword = process.env.SPARK_API_PASSWORD;
    
    res.json({
        version: '2024-05-07-v2',
        appid_set: !!appid,
        appid_value: appid,
        apiKey_set: !!apiKey,
        apiSecret_set: !!apiSecret,
        apiPassword_set: !!apiPassword,
        apiPassword_prefix: apiPassword ? apiPassword.substring(0, 8) + '...' : null
    });
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
