const https = require('https');

const API_KEY = 'AIzaSyBj-033GCRbvuZRvSnsV2KlFzhPFZYoF2g';

const options = {
    hostname: 'www.googleapis.com',
    path: `/youtube/v3/search?part=snippet&q=test&type=video&maxResults=1&key=${API_KEY}`,
    method: 'GET',
};

const req = https.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
        console.log('Status Code:', res.statusCode);
        if (res.statusCode !== 200) {
            const errorData = JSON.parse(body);
            console.log('Error Body:', JSON.stringify(errorData, null, 2));

            // Extract project ID from error if present
            if (errorData.error && errorData.error.message) {
                const projectMatch = errorData.error.message.match(/project (\d+)/);
                if (projectMatch) {
                    console.log('\n❌ THIS KEY IS FROM PROJECT:', projectMatch[1]);
                    console.log('Expected: gen-lang-client-0934750585');
                }
            }
        } else {
            console.log('✅ Key works! Response:', body.substring(0, 200));
        }
    });
});

req.on('error', (error) => {
    console.error('Error:', error);
});

req.end();
