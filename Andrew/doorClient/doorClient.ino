#include <SoftwareSerial.h>

#define rxPin 2
#define txPin 3
#define ledPin 4
#define servoPin 5
#define comSerial Serial

Servo servo;

SoftwareSerial espSerial(rxPin, txPin);

String data;


void setup() {
  comSerial.begin(9600);
  espSerial.begin(115200);
  pinMode(ledPin, OUTPUT);
  servo.attach(servoPin);
  servo.write(180);
}

void loop() {
  if(espSerial.available() > 0){
    data = espSerial.readString();
    if (data == "0578d33e-0f83-411d-91e8-a6eb3add4432"){
      if(comSerial){  
        comSerial.println("Open the door")
      }
      servo.write(90);
      digitalWrite(ledPin, HIGH);      
    }

    else if (data == "c2d4e359-1171-44c0-b1c7-4ab44b9de44a"){
      if(comSerial){
        comSerial.println("Close the door")
      }
      servo.write(180);
      digitalWrite(ledPin, LOW);
    }

    else {
      if(comSerial){
        comSerial.println("Unknown command")
      }
    }
  }
}
