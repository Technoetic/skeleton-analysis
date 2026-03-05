async function fetchRecords() {
  const resp = await fetch('/api/records');
  if (!resp.ok) throw new Error(`API error: ${resp.status}`);
  return resp.json();
}

let RAW_DATA = [];
const _supabaseReady = fetchRecords().then(data => {
  RAW_DATA = data;
}).catch(err => {
  console.error('API fetch failed, falling back to empty data:', err);
  RAW_DATA = [];
});
