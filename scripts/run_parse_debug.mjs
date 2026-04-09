const paperId = process.argv[2];

if (!paperId) {
  console.error('Missing paper id.');
  process.exit(1);
}

const response = await fetch(`http://localhost:3002/api/papers/${paperId}/parse`, {
  method: 'POST',
});

console.log('status', response.status);
console.log(await response.text());