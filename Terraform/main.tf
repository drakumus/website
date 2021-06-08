terraform {
  required_providers {
    digitalocean = {
      source = "digitalocean/digitalocean"
      version = "~> 2.0"
    }
  }
}

# Configure the DigitalOcean Provider
provider "digitalocean" {
  token = var.do_token
}

#resource "digitalocean_ssh_key" "default" {
#  name       = "General Accessor"
#  public_key = file("/Users/terraform/.ssh/id_rsa.pub")
#}

resource "digitalocean_droplet" "web" {
  image  = "docker-20-04"
  name   = "ProjectServer1"
  region = "nyc3"
  size   = "s-1vcpu-1gb"
  #ssh_keys = [digitalocean_ssh_key.default.fingerprint]
}

resource "digitalocean_project" "Personal" {
  name        = "Personal"
  description = "A project to represent development resources."
  purpose     = "Web Application"
  environment = "Development"
  resources   = [digitalocean_droplet.web.urn]
}