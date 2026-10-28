import app from './app';

const port = Number(process.env.NILAI_PORT || 3001);
app.listen(port, () => {
  console.log(`Service Nilai running on http://localhost:${port}`);
});
