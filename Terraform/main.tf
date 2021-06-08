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

resource "digitalocean_ssh_key" "default" {
  name       = "General Accessor"
  public_key = file(var.public_ssh_key)
}

# need variables do_token, private_key for this to work
resource "digitalocean_droplet" "web" {
  image  = "docker-20-04"
  name   = "ProjectServer1"
  region = "nyc3"
  size   = "s-1vcpu-1gb"
  ssh_keys = [digitalocean_ssh_key.default.fingerprint]

# working code to connect and execute commands on remote after creation
  # connection exists for provisioner to connect
#  connection {
#    host = self.ipv4_address
#    user = "root"
#    type = "ssh"
#    private_key = file(var.private_ssh_key)
#    timeout = "10m"
#  }
#  provisioner "remote-exec" {
#    inline = [
#      #"export PATH=$PATH:/usr/bin",
#      #install nginx
#      #"sudo apt-get update",
#      #"sudo apt-get -y install nginx"
#      "ip address show"
#    ]
#  }
}

output "ssh_address" {
  value = digitalocean_droplet.web.ipv4_address
}

resource "local_file" "ssh_session_file" {

  content = "terraform = #109#0%${digitalocean_droplet.web.ipv4_address}%22%root%%-1%-1%%%22%%0%0%0%_ProfileDir_\\Documents\\rsa\\terraform\\project_server%%-1%0%0%0%%1080%%0%0%1#MobaFont%10%0%0%0%15%236,236,236%30,30,30%180,180,192%0%-1%0%%xterm%-1%-1%_Std_Colors_0_%80%24%0%1%-1%<none>%%0#0# #-1"
  filename = "${path.module}/terraform.moba"
}

resource "digitalocean_project" "Personal" {
  name        = "Personal"
  description = "A project to represent development resources."
  purpose     = "Web Application"
  environment = "Development"
  resources   = [digitalocean_droplet.web.urn]
}