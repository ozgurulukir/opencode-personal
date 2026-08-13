// Unit tests for the SSRF IP-range guard in tool/webfetch.ts. These pin down
// the hardened private/reserved IPv4 + IPv6 classification (including DNS
// rebinding defense-in-depth ranges and fail-closed malformed input).

import { describe, expect, test } from "bun:test"
import { isPrivateIP, isPrivateIPv4 } from "../../src/tool/webfetch"

describe("webfetch.isPrivateIPv4", () => {
  const privateIPs = [
    "0.0.0.0",
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // IMDS
    "169.254.0.1",
    "100.64.0.1", // CGNAT
    "192.0.0.1", // IETF protocol
    "192.0.2.1", // TEST-NET-1
    "198.18.0.1", // benchmarking
    "224.0.0.1", // multicast
    "240.0.0.1", // reserved
    "255.255.255.255",
  ]
  for (const ip of privateIPs) {
    test(`flags ${ip} as private/reserved`, () => expect(isPrivateIPv4(ip)).toBe(true))
  }

  const publicIPs = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "223.163.54.52"]
  for (const ip of publicIPs) {
    test(`allows ${ip}`, () => expect(isPrivateIPv4(ip)).toBe(false))
  }

  test("fails closed on malformed input", () => {
    expect(isPrivateIPv4("not-an-ip")).toBe(true)
    expect(isPrivateIPv4("999.1.1.1")).toBe(true)
    expect(isPrivateIPv4("192.168.1")).toBe(true)
  })
})

describe("webfetch.isPrivateIP", () => {
  const privateIPs = [
    "::1", // loopback
    "::", // unspecified
    "fe80::1", // link-local
    "fc00::1", // unique local
    "fd12::1", // unique local
    "ff02::1", // multicast
    "100::1", // discard-only
    "2001:db8::1", // documentation
    "64:ff9b::1", // NAT64
    "2001::1", // Teredo
    "2002::1", // 6to4
    "::ffff:10.0.0.1", // IPv4-mapped private
  ]
  for (const ip of privateIPs) {
    test(`flags ${ip} as private/reserved`, () => expect(isPrivateIP(ip)).toBe(true))
  }

  test("allows public native IPv6", () => {
    expect(isPrivateIP("2001:4860:4860::8888")).toBe(false) // Google Public DNS
    expect(isPrivateIP("2606:4700:4700::1111")).toBe(false) // Cloudflare
  })

  test("allows IPv4-mapped PUBLIC addresses", () => {
    expect(isPrivateIP("::ffff:8.8.8.8")).toBe(false)
  })

  test("flags IPv4-mapped PRIVATE and embedded forms", () => {
    expect(isPrivateIP("::ffff:192.168.1.5")).toBe(true)
    expect(isPrivateIP("::ffff:169.254.169.254")).toBe(true)
  })
})