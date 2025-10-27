// engine.js - The Crash Game Server Logic
const admin = require("firebase-admin");

// এই serviceAccountKey.json ফাইলটি আপনার গোপন চাবির মতো কাজ করবে
const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  // আপনার ফায়ারবেস ডাটাবেস ইউআরএল
  databaseURL: "https://lodutunament-34229-default-rtdb.firebaseio.com" 
});

const db = admin.database();
const gameRef = db.ref('crashGame');
const historyRef = db.ref('crashHistory');
const usersRef = db.ref('users');

const WAITING_TIME = 10000; // 10 সেকেন্ড
const CRASHED_TIME = 5000;  // 5 সেকেন্ড
const GAME_TICK = 100;      // প্রতি 100 মিলিসেকেন্ডে গেম আপডেট হবে

let gameLoopInterval = null;

// ক্রিপ্টোগ্রাফিকভাবে নিরাপদ র‍্যান্ডম নম্বর তৈরি করা
function generateSecureRandom() {
    const randomBytes = require('crypto').randomBytes(4);
    return randomBytes.readUInt32BE(0) / 0x100000000;
}

// এই ফাংশনটি একটি ন্যায্য ক্র্যাশ পয়েন্ট তৈরি করে
function generateCrashPoint() {
    const r = generateSecureRandom();
    const crashPoint = 1 / (1 - r);
    
    // বেশিরভাগ ফলাফলকে ছোট রাখার জন্য একটি বন্টন
    // ৯৫% সম্ভাবনা 1.00x থেকে 10.00x এর মধ্যে ক্র্যাশ হওয়ার
    if (Math.random() < 0.95) {
        return Math.max(1.01, Math.min(crashPoint, 10));
    }
    
    // বাকি ৫% সম্ভাবনা বড় মাল্টিপ্লায়ার হওয়ার
    return Math.max(10.01, Math.min(crashPoint, 50));
}

async function runGameCycle() {
    try {
        console.log("Starting a new game cycle...");

        // =========== WAITING PHASE ===========
        const roundId = historyRef.push().key;
        const crashPoint = parseFloat(generateCrashPoint().toFixed(2));
        
        console.log(`New round #${roundId}. Crashing at ${crashPoint}x`);

        await gameRef.set({
            status: 'waiting',
            multiplier: 1.00,
            nextRoundTime: Date.now() + WAITING_TIME,
            roundId: roundId,
            bets: {},
            forceCrash: false
        });

        await new Promise(resolve => setTimeout(resolve, WAITING_TIME));

        // =========== RUNNING PHASE ===========
        const startTime = Date.now();
        await gameRef.update({ status: 'running' });
        console.log("Game is now running...");

        let currentMultiplier = 1.00;
        let running = true;

        while (running) {
            const elapsedTime = (Date.now() - startTime) / 1000; // সেকেন্ডে
            currentMultiplier = Math.pow(Math.E, 0.06 * elapsedTime);
            
            const gameState = (await gameRef.once('value')).val();
            if (gameState.forceCrash) {
                console.log("Force crash initiated by admin!");
                currentMultiplier = 1.00; 
                running = false;
            } else if (currentMultiplier >= crashPoint) {
                currentMultiplier = crashPoint;
                running = false;
            } else {
                await gameRef.update({ multiplier: currentMultiplier });
                await new Promise(resolve => setTimeout(resolve, GAME_TICK));
            }
        }
        
        // =========== CRASHED PHASE ===========
        const finalMultiplier = parseFloat(currentMultiplier.toFixed(2));
        console.log(`Crashed at ${finalMultiplier}x`);

        const finalGameState = (await gameRef.once('value')).val();
        
        if(finalGameState && finalGameState.bets) {
            for (const [userId, bet] of Object.entries(finalGameState.bets)) {
                if (bet.cashedOut === false) {
                     console.log(`User ${userId} lost ${bet.amount}`);
                } else {
                    console.log(`User ${userId} already cashed out at ${bet.cashoutMultiplier.toFixed(2)}x`);
                }
            }
        }

        await gameRef.update({ 
            status: 'crashed', 
            crashedAt: finalMultiplier
        });
        
        await historyRef.child(roundId).set({
            crashedAt: finalMultiplier,
            timestamp: Date.now()
        });

        console.log("Crash result saved. Waiting for next round...");
        await new Promise(resolve => setTimeout(resolve, CRASHED_TIME));

    } catch (error) {
        console.error("An error occurred in the game cycle:", error);
        await new Promise(resolve => setTimeout(resolve, 5000)); // ত্রুটি হলে ৫ সেকেন্ড অপেক্ষা করুন
    } finally {
        runGameCycle(); // পরবর্তী রাউন্ড শুরু করুন
    }
}

// Admin restart listener
db.ref().on('value', (snapshot) => {
    if(!snapshot.hasChild('crashGame')) {
        console.log("Admin or system triggered a game restart. Initializing...");
        if(gameLoopInterval) clearInterval(gameLoopInterval);
        runGameCycle();
    }
});

// Start the first game cycle
runGameCycle();
