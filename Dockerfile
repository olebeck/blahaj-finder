FROM node:alpine

WORKDIR /app

ADD . .

RUN yarn

CMD [ "yarn", "start" ]