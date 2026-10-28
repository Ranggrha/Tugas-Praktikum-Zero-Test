import app from './app';

const port = Number(process.env.TRANSKRIP_PORT || 3002);
app.listen(port, () => {
  console.log(`Service Transkrip running on http://localhost:${port}`);
});
