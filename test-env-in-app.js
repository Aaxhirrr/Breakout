// This script will show what process.env.GEMINI_API_KEY resolves to when loaded like Next.js does
require('dotenv').config({ path: '.env.local' });

console.log('GEMINI_API_KEY from process.env:', process.env.GEMINI_API_KEY);
console.log('First 20 chars:', process.env.GEMINI_API_KEY?.substring(0, 20));
console.log('Expected:', 'AIzaSyBj-033GCRbvuZ');
console.log('Match?', process.env.GEMINI_API_KEY === 'AIzaSyBj-033GCRbvuZRvSnsV2KlFzhPFZYoF2g');
