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

// 获取下载URL（心得需要密码验证）
app.get('/api/download', async (req, res) => {
    try {
        const { key, password } = req.query;
        
        // 判断是否是心得文件
        if (key.includes('/xinde/')) {
            const correctPassword = process.env.DELETE_PASSWORD || 'mami';
            if (password !== correctPassword) {
                return res.status(403).json({ success: false, error: '密码错误' });
            }
        }
        
        const url = `https://${BUCKET}.cos.${REGION}.myqcloud.com/${encodeURIComponent(key)}`;
        res.json({ success: true, url });
    } catch (error) {
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

// 讯飞星火对话接口
app.post('/api/chat', async (req, res) => {
    try {
        const { message, history = [] } = req.body;
        
        const appid = process.env.SPARK_APPID;
        const apiKey = process.env.SPARK_API_KEY;
        const apiSecret = process.env.SPARK_API_SECRET;
        
        console.log('Chat request received:', { appid: appid ? 'set' : 'missing', apiKey: apiKey ? 'set' : 'missing', apiSecret: apiSecret ? 'set' : 'missing' });
        
        if (!appid || !apiKey || !apiSecret) {
            return res.status(500).json({ success: false, error: '星火API配置缺失' });
        }
        
        // 构建鉴权URL - 使用通用路径
        const host = 'spark-api.xf-yun.com';
        const path = '/v1.1/chat';
        const date = new Date().toUTCString();
        const signatureOrigin = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;
        const signature = crypto.createHmac('sha256', apiSecret).update(signatureOrigin).digest('base64');
        const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
        const authorization = Buffer.from(authorizationOrigin).toString('base64');
        const url = `wss://${host}${path}?authorization=${authorization}&date=${encodeURIComponent(date)}&host=${host}`;
        
        console.log('Connecting to Spark API...');
        
        // 连接WebSocket
        const ws = new WebSocket(url);
        let responseText = '';
        let hasResponded = false;
        
        ws.on('open', () => {
            console.log('WebSocket connected');
            const messages = [
                { role: 'system', content: 'You are a helpful English teacher. Help the user practice English. If they write in Chinese, explain in Chinese but encourage them to use English. Correct their grammar mistakes gently.' },
                ...history,
                { role: 'user', content: message }
            ];
            
            const requestData = {
                header: { app_id: appid, uid: 'user' },
                parameter: { chat: { domain: 'general', temperature: 0.7, max_tokens: 2048 } },
                payload: { message: { text: messages } }
            };
            
            console.log('Sending request to Spark');
            ws.send(JSON.stringify(requestData));
        });
        
        ws.on('message', (data) => {
            try {
                const result = JSON.parse(data);
                console.log('Received message, code:', result.header?.code);
                
                // 检查错误码
                if (result.header && result.header.code !== 0) {
                    console.error('Spark API error:', result.header.message);
                    if (!hasResponded) {
                        hasResponded = true;
                        res.status(500).json({ success: false, error: result.header.message || '星火API错误' });
                    }
                    ws.close();
                    return;
                }
                
                if (result.payload && result.payload.choices && result.payload.choices.text) {
                    const text = result.payload.choices.text[0].content;
                    responseText += text;
                    
                    // status: 2 表示最后一帧
                    if (result.payload.choices.status === 2) {
                        console.log('Response complete, length:', responseText.length);
                        ws.close();
                        if (!hasResponded) {
                            hasResponded = true;
                            res.json({ success: true, reply: responseText });
                        }
                    }
                }
            } catch (parseError) {
                console.error('Parse error:', parseError);
            }
        });
        
        ws.on('error', (error) => {
            console.error('WebSocket error:', error.message || error);
            if (!hasResponded) {
                hasResponded = true;
                res.status(500).json({ success: false, error: 'WebSocket错误: ' + (error.message || '未知错误') });
            }
        });
        
        ws.on('close', (code) => {
            console.log('WebSocket closed, code:', code);
            if (!hasResponded) {
                hasResponded = true;
                if (responseText) {
                    res.json({ success: true, reply: responseText });
                } else {
                    res.status(500).json({ success: false, error: '连接已关闭，未收到回复' });
                }
            }
        });
        
        // 超时处理
        setTimeout(() => {
            if (!hasResponded) {
                hasResponded = true;
                ws.terminate();
                res.status(504).json({ success: false, error: '请求超时' });
            }
        }, 30000);
        
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
    
    res.json({
        appid_set: !!appid,
        appid_length: appid ? appid.length : 0,
        apiKey_set: !!apiKey,
        apiKey_length: apiKey ? apiKey.length : 0,
        apiSecret_set: !!apiSecret,
        apiSecret_length: apiSecret ? apiSecret.length : 0
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
