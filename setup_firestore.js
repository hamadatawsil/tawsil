const firebase = require('firebase-admin');
const serviceAccount = require('./serviceAccount.json');

firebase.initializeApp({ credential: firebase.credential.cert(serviceAccount) });
const db = firebase.firestore();

async function setup() {
  const adminRef = db.collection('admins').doc('admin');
  const doc = await adminRef.get();
  if (doc.exists) {
    console.log('Admin already exists');
    return;
  }
  await adminRef.set({
    username: 'admin',
    password: 'admin123',
    full_name: 'مدير النظام',
    role: 'owner',
  });
  console.log('Admin created: admin / admin123');
  await db.collection('settings').doc('subscription_fee').set({ value: 500 });
  await db.collection('settings').doc('payment_phone').set({ value: '+222 33 123 45 67' });
  await db.collection('settings').doc('payment_note').set({ value: 'قم بالإرسال من خلال بنكيلي أو مصرفي أو بيم بانك أو السداد إلى' });
  console.log('Default settings created');
}

setup().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
