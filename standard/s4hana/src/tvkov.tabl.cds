@EndUserText.label : 'Sales org + distribution channel'
define table tvkov {
  key mandt : abap.clnt not null;
  key vkorg : abap.char(4) not null;
  key vtweg : abap.char(2) not null;
}
