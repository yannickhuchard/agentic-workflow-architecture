
const { PrismaClient } = require('@prisma/client');
const { v4: uuidv4 } = require('uuid');

const prisma = new PrismaClient();

async function seed() {
    const tasks = [
        {
            id: uuidv4(),
            activity_id: uuidv4(),
            activity_name: 'Verify Bank Statement',
            token_id: uuidv4(),
            workflow_id: uuidv4(),
            status: 'pending',
            priority: 'high',
            role_id: uuidv4(),
            inputs: JSON.stringify({ customer: 'John Doe', amount: 5000 }),
            description: 'Please verify the bank statement for the last 3 months.',
            created_at: new Date(),
            updated_at: new Date(),
        },
        {
            id: uuidv4(),
            activity_id: uuidv4(),
            activity_name: 'Approve Reimbursement',
            token_id: uuidv4(),
            workflow_id: uuidv4(),
            status: 'in_progress',
            priority: 'normal',
            role_id: uuidv4(),
            assignee_id: 'user-1',
            inputs: JSON.stringify({ report_id: 'EXP-999', total: 125.50 }),
            description: 'Staff travel reimbursement for Amsterdam conference.',
            created_at: new Date(),
            updated_at: new Date(),
        },
        {
            id: uuidv4(),
            activity_id: uuidv4(),
            activity_name: 'Final Quality Check',
            token_id: uuidv4(),
            workflow_id: uuidv4(),
            status: 'pending',
            priority: 'critical',
            role_id: uuidv4(),
            inputs: JSON.stringify({ batch_id: 'BATCH-A1' }),
            description: 'Last check before dispatch.',
            created_at: new Date(),
            updated_at: new Date(),
        }
    ];

    for (const task of tasks) {
        await prisma.humanTask.create({ data: task });
        console.log(`Created task: ${task.activity_name}`);
    }

    await prisma.$disconnect();
}

seed().catch(e => {
    console.error(e);
    process.exit(1);
});
