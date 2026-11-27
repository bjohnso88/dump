// Prints a fresh VAPID key pair for web push. Run once: npm run vapid
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const pub = Buffer.from(await crypto.subtle.exportKey('raw', kp.publicKey)).toString('base64url');
const { d } = await crypto.subtle.exportKey('jwk', kp.privateKey);
console.log('VAPID_PUBLIC_KEY =', pub);
console.log('VAPID_PRIVATE_KEY =', d);
