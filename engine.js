// engine.js - The Crash Game Server Logic (Final Version for Koyeb)
const admin = require("firebase-admin");
const crypto = require('crypto'); // We need to import crypto

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://lodutunament-34229-default-rtdb.firebaseio.com" 
});

const db = admin.database();
const gameRef = db.ref('crashGame');
const historyRef = db.ref('crashHistory');

const WAITING_TIME = 10000;
const CRASHED_TIME = 5000;
const GAME_TICK = 100;

// A fair crash point generator using Node.js crypto
function generateCrashPoint() {
    const hash = crypto.createHmac('sha256', crypto.randomBytes(32)).update(crypto.randomBytes(32)).digest('hex');
    const hex = hash.substring(0, 13);
    const int = parseInt(hex, 16);
    const crashPoint = Math.max(1, Math.floor(100 * (2**52 - int)) / (2**52 - int)) / 100;

    if (crashPoint < 1.01) return 1.01;
    return parseFloat(crashPoint.toFixed(2));
}

async function runGameCycle() {
    try {
        console.log("Starting a new game cycle...");

        const roundId = historyRef.push().key;
        const crashPoint = generateCrashPoint();
        
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

        const startTime = Date.now();
        await gameRef.update({ status: 'running' });
        console.log("Game is now running...");

        let currentMultiplier = 1.00;
        
        while (currentMultiplier < crashPoint) {
            const elapsedTime = (Date.now() - startTime) / 1000;
            currentMultiplier = Math.pow(Math.E, 0.06 * elapsedTime);
            
            await gameRef.update({ multiplier: currentMultiplier });
            await new Promise(resolve => setTimeout(resolve, GAME_TICK));
            
            const gameState = (await gameRef.once('value')).val();
            if (gameState.forceCrash) {
                console.log("Force crash initiated by admin!");
                currentMultiplier = 1.00;
                break; 
            }
        }
        
        const finalMultiplier = (currentMultiplier < crashPoint) ? 1.00 : crashPoint;
        console.log(`Crashed at ${finalMultiplier}x`);

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
        await new Promise(resolve => setTimeout(resolve, 5000));
    } finally {
        runGameCycle();
    }
}

// Start the game
runGameCycle();
