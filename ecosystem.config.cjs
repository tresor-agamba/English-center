module.exports = {
  apps: [{
    name: 'english-center',
    script: 'src/server.js',
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '512M',
    kill_timeout: 20000,
    wait_ready: false,
    time: true,
    out_file: 'logs/application.log',
    error_file: 'logs/error.log',
    env_production: { NODE_ENV: 'production' },
  }],
};
