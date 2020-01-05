FROM node:12.0-slim
RUN mkdir nodejs_app
COPY . /nodejs_app

RUN apt-get -y update
RUN apt-get -y install python2.7 python-pip
RUN apt-get -y install git
RUN pip install pyyaml
RUN pip install pylint
RUN pip install pycodestyle
RUN pip install git-lint

RUN npm install --prefix=/nodejs_app

CMD [ "cd", "nodejs_app" ]
CMD [ "npm", "start" ]
