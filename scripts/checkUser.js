
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUser() {
    try {
        const derivId = 'CR6550175';
        console.log(`Checking for user with derivId: ${derivId}`);

        // Find by derivId (username in schema usually stores derivId)
        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { username: derivId },
                    { email: 'muindidamian@gmail.com' } // from logs
                ]
            }
        });

        if (user) {
            console.log('User found:', user);

            // Check if another user '44dummies' exists
            const dummy = await prisma.user.findUnique({ where: { username: '44dummies' } });
            if (dummy) {
                console.log('User "44dummies" also found:', dummy);
                console.log('ARE THEY THE SAME ID?', user.id === dummy.id);
            } else {
                console.log('User "44dummies" NOT found.');
            }

        } else {
            console.log('User NOT found.');
        }
    } catch (error) {
        console.error('Error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

checkUser();
