#!/bin/bash

# optimize_server.sh
# Purpose: Setup swap space and tune performance for 2GB RAM EC2 instances.

echo "🚀 Starting server optimization..."

# 1. Setup 2GB Swap File
if [ -f /swapfile ]; then
    echo "✅ Swap file already exists."
else
    echo "📦 Creating 2GB swap file..."
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    echo "✅ Swap file created and enabled."
fi

# 2. Tune Swappiness
# Set swappiness to 10 (less aggressive swapping, better for SSDs)
echo "🔧 Tuning swappiness..."
sudo sysctl vm.swappiness=10
echo 'vm.swappiness=10' | sudo tee -a /etc/sysctl.conf

# 3. Tune File Descriptor Limits
echo "🔧 Increasing file descriptor limits..."
echo "* soft nofile 65535" | sudo tee -a /etc/security/limits.conf
echo "* hard nofile 65535" | sudo tee -a /etc/security/limits.conf

echo "🎉 Server optimization complete!"
echo "Recommended: Run 'free -h' to verify swap space."
