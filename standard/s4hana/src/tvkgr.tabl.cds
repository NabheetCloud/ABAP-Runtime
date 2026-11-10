@EndUserText.label : 'Sales group'
define table tvkgr {
  key mandt : abap.clnt not null;
  key vkgrp : abap.char(3) not null;
  bezei     : abap.char(40);
}
