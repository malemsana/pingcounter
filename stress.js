const URL = "http://127.0.0.1:3000/p/pc_6600ac033f5888cd093a852be6d19da925bb881c042bdf4c4c688d9a22fc3fc0/Malemsana/test";

const TOTAL_REQUESTS = 12;
const CONCURRENCY = 6;

async function worker(id) {
  for (let i = 0; i < TOTAL_REQUESTS / CONCURRENCY; i++) {
    try {
      await fetch(URL);
    } catch (err) {
      console.error("Worker", id, "error");
    }
  }
}

async function run() {
  console.log(`Starting stress test`);
  console.log(`Requests: ${TOTAL_REQUESTS}`);
  console.log(`Concurrency: ${CONCURRENCY}`);

  const start = Date.now();

  const workers = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    workers.push(worker(i));
  }

  await Promise.all(workers);

  const time = (Date.now() - start) / 1000;

  console.log(`Finished in ${time}s`);
  console.log(`${Math.round(TOTAL_REQUESTS / time)} req/sec`);
}

run();