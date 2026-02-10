const https = require('https');

const API_KEY = 'AIzaSyBj-033GCRbvuZRvSnsV2KlFzhPFZYoF2g';
const data = JSON.stringify({
    contents: [{ parts: [{ text: "Explain the verification of this api" }] }]
});

const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
        console.log('Status Code:', res.statusCode);
        console.log('Body:', body);
    });
});

req.on('error', (error) => {
    console.error('Error:', error);
});

req.write(data);
req.end();
