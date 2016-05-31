## Client for pheromon

### Install raspbian lite

```
wget https://downloads.raspberrypi.org/raspbian_lite_latest
unzip 
# do diskutil list to see where the SD card is mounted
diskutil unmountDisk /dev/diskX
sudo dd if=2016-05-10-raspbian-jessie-lite.img  of=/dev/rdiskX bs=8m
# you can now log in with (passwd: raspberry)
ssh pi@raspberrypi.local
sudo su
cd
mkdir .ssh
# add the content of your computer ~/.ssh/id_rsa.pub to the rpi .ssh/authorized_keys
apt-get update
apt-get install -y python
```


mosquitto_passwd -c /etc/mosquitto/passwd gip