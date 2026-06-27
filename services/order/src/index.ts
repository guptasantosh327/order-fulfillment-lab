import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);

const app = createApp();

app.listen(port, () => {
  console.log(`order service listening on port ${port}`);
});
