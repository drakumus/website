# Website that deploys itself - Full CI/CD pipeline

---
## Automation
Having everything happen automatically was a key goal of this project, 
even down to things like deploying server instances, registering DNS entries, 
and creating/renewing HTTPS certificates. This was accomplished in part by 
the companion project to this one.

https://github.com/drakumus/DigitalOceanDropletTerraform

### When changes are pushed to this repository, GitHub Actions will
1. Build, Tag, and Upload a docker image based off of nginx, but with the 
   website src added
2. Connect to the remote DigitalOcean server with auto-provisioned ssh keys 
3. Upload `docker-compose.yml` and `init-letsencrypt.sh`
4. Init certbot on first launch, or do nothing
5. Deploy Docker Compose services (website and certbot)

---
### Local Development
rebuilds and executes as a detached instance of the docker container

```
docker compose up --build -d
```
