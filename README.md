# Robocodecup-runner script
This script can be used to run robocode battles for a set of teams. The scripts does the following:
- Connects to a docker container for running robocode battles
- Extract all team jar files in the given folder to a temporary output folder
- Generate battle files based on the teams. Every team against every other team
- Runs a the battles specified in the battle files and writes score and replay files
- Parses all output files and build up a JSON file with the output of the competition

## Requirements
You need to have docker installed on your system.

## Download and setup
- Clone the repo and run

  ```git clone <ROBOCODE-RUNNER-GIT-REPO-URL>```
- Create a docker image based on the given Dockerfile. Use the command

  ```docker build -t robocoderunner .```

- Run the docker image

  ```docker run -dit -v <YOUR-WORKING-FOLDER>:/robocode/workingfolder --name robocode-runner robocoderunner```

## Running the script
- Start the script with the following command

  ```node index.js -w <ABSOLUTE-PATH-TO-YOUR-WORKING-FOLDER> -t <YOUR-TEAM-FOLDER>```

  Where your working folder is the same folder as specified above for the docker image.
  The Team folder should contain a list of files with the following naming conventions:

  ```nl.saxion.<TEAMCODE>.*.jar```
