const https = require('https');

const API_KEY = 'AIzaSyBj-033GCRbvuZRvSnsV2KlFzhPFZYoF2g';

const options = {
    hostname: 'generativelanguage.googleapis.com',
    path: `/v1beta/models?key=${API_KEY}`,
    method: 'GET',
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

req.end();
