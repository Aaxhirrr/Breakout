const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');

console.log('--- .env.local Content ---');
console.log(envContent);

const keyMatch = envContent.match(/GEMINI_API_KEY=(.+)/);
if (keyMatch) {
    const key = keyMatch[1].trim();
    console.log('Parsed Key:', key);
    console.log('Is Correct?', key === 'AIzaSyBj-033GCRbvuZRvSnsV2KlFzhPFZYoF2g');
} else {
    console.log('Key NOT FOUND in file');
}
