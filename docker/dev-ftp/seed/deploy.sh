#!/bin/sh
set -eu
# Deploy the static site to the shared host.
rsync -avz --delete public_html/ deploy@example.com:/srv/www/
echo "deployed $(date -u +%FT%TZ)"
