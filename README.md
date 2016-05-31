## Client for pheromon

### Install ubuntu core

https://developer.ubuntu.com/en/snappy/start/raspberry-pi-2/


```
xz -d ubuntu-15.04-snappy-armhf-raspi2.img.xz
# do diskutil list to see where the SD card is mounted
diskutil unmountDisk /dev/diskX
sudo dd if=ubuntu-15.04-snappy-armhf-raspi2.img of=/dev/rdisk2 bs=4m
# you can now log in with (passwd: ubuntu)
ssh ubuntu@webdm.local
```


mosquitto_passwd -c /etc/mosquitto/passwd gip