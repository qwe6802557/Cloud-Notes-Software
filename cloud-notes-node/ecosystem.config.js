module.exports = {
    apps: [
        {
            name: 'cloud-notes-node',
            cwd: __dirname,
            script: 'src/app.js',
            instances: 1,
            exec_mode: 'fork',
            watch: false,
            autorestart: true,
            max_memory_restart: '512M',
            env: {
                NODE_ENV: 'production'
            }
        }
    ]
};
