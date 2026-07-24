#!/bin/bash
exec /usr/bin/chromium --test-type --disable-session-crashed-bubble --disable-infobars "$@"
