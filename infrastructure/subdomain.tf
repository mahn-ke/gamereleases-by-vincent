resource "random_password" "ddns_password" {
  length  = 30
  special = false
}

locals {
  subdomain_label = replace(replace(basename(dirname(path.cwd)), "-by-vincent", ""), "-", ".")
}

resource "allinkl_ddns" "subdomain" {
  dyndns_comment   = replace(local.subdomain_label, ".", "_")
  dyndns_password  = random_password.ddns_password.result
  dyndns_zone      = "mahn.ke"
  dyndns_label     = "${local.subdomain_label}.by.vincent"
  dyndns_target_ip = "88.99.215.101"
}