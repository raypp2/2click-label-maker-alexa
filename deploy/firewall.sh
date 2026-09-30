#!/bin/sh
# Egress firewall for the internet-facing Alexa containers (ts-alexa + alexa share
# this network namespace). Rootless Docker sends container traffic out through the
# Pi host, including the host tailscale0, so without this the skill would inherit
# the Pi's tailnet access and reach the home LAN. Allowed: loopback, the compose
# network (label maker), and the public internet. Refused: tailnet and private ranges.
set -e
NET=$(ip -4 route show dev eth0 scope link | awk '{print $1; exit}')
iptables -F OUTPUT
iptables -A OUTPUT -o lo -j ACCEPT
iptables -A OUTPUT -d "$NET" -j ACCEPT
for cidr in 100.64.0.0/10 10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 169.254.0.0/16; do
  iptables -A OUTPUT -d "$cidr" -j REJECT
done
# IPv6: only matters if this namespace can route IPv6 at all. If it can, the
# rules are mandatory (fail closed); if there is no IPv6 route, there is nothing to block.
if ip -6 route show default 2>/dev/null | grep -q . || ip -6 addr show scope global 2>/dev/null | grep -q inet6; then
  IP6=ip6tables
  $IP6 -S OUTPUT >/dev/null 2>&1 || IP6=ip6tables-nft
  $IP6 -F OUTPUT
  $IP6 -A OUTPUT -o lo -j ACCEPT
  for cidr in fd7a:115c:a1e0::/48 fc00::/7 fe80::/10; do
    $IP6 -A OUTPUT -d "$cidr" -j REJECT
  done
else
  echo "no IPv6 in this namespace; IPv6 rules not needed"
fi
echo "alexa egress firewall applied (compose net $NET allowed)"
exec /usr/local/bin/containerboot
