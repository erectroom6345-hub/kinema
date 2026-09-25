#!/bin/zsh
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
cd /Users/miyasakaharuki/treasure-shop-hp/content-studio || exit 1
/usr/local/bin/npm start -- --input samples/beauty-input.json >> /Users/miyasakaharuki/treasure-shop-hp/content-studio/output/cron.log 2>&1
