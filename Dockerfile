FROM openjdk:8
RUN mkdir -p /robocode
ADD https://sourceforge.net/projects/robocode/files/robocode/1.9.3.0/robocode-1.9.3.0-setup.jar/download /robocode
WORKDIR /robocode
RUN jar xvf *
