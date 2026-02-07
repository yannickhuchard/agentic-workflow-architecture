import express from 'express';
import cors from 'cors';
import { workflowRouter } from './routes/workflows';

export const createServer = () => {
    const app = express();

    app.use(cors());
    app.use(express.json());

    app.use('/api/v1/workflows', workflowRouter);

    app.get('/health', (req, res) => {
        res.json({ status: 'ok' });
    });

    return app;
};
