/*
 *Author: Jacob Goodall
 *Date: 02/08/2022
 *Description: Create FARO Fulfillment record
 */

function createRecord() {
  /*
    KEVIN:
    GOAL: Your GOAL is to determine which lines on these orders have been shipped - and fulfill those lines in Netsuite with tracking.
    Steps:
    Loop through results of saved search
    for each order:
      send GET call with orderId of the order
      loop through response lines from FARO
        loop through lines on fulfillment record
          when you match FARO's line to the Netsuite line
            check if status is shipped
            if so: check the fulfill checkbox on that line, and store the tracking number somewhere
      
      after you've looped through everything, add the tracking number(s) to the fulfillment record and save it.
  */
  
    var header = {
      'Cache-Control' : 'no-cache',
      'Content-Type' : 'application/json',
      'Authorization':'ZeRuuM3HfZHJHwkG0JomklVHVbnhN7EB'
    };
  
  
    //Test orders arn't in the serach anymore. We have a couple live orders though now
    var results = nlapiSearchRecord('salesorder','customsearch5105');
  
    if(results) {
  
      var checkGovernance = function() {
  
        var governanceThreshold = 500;
        var context = nlapiGetContext();
  
        if(context.getRemainingUsage() < governanceThreshold) {
  
          try{
            
            var script = nlapiScheduleScript('customscript_op_sched_faro_fulfillment');
  
            if(script == 'QUEUED') {
              nlapiLogExecution('ERROR','Re-scheduling due to governance', 'Successful re-schedule.');
              return true;
            }
            else {
              nlapiLogExecution('ERROR','Problem re-scheduling.', e.code+' : '+e.message);
              return true;
            }
            
          }
          catch(e) {
            nlapiLogExecution('ERROR','Problem re-scheduling.', e.code+' : '+e.message);
            return true;
          }
        }
        else {
          return false;
        }
  
      };
  
      for(var i = 0; i<results.length; i++) {
  
        try {
  
          var rec = nlapiLoadRecord('salesorder',results[i].getValue('internalid',null,'GROUP'));
  
          //SO internal id
          var internalId = rec.getId();
  
          //KEVIN: we're storing their orderid at the line level in custcol_3rd_party_order_id. But, if they return all lines when you use internalid, we can just use that instead.

          //Build array of unique order ids
          var orderIds = [];
          var prevId = null;
          var thisId = null;

          for(var x=1; x<=rec.getLineItemCount('item'); x++){
            if(rec.getLineItemValue('item','custcol_3rd_party_order_id',x) != '' && rec.getLineItemValue('item','custcol_3rd_party_order_id',x) != null){
              if(Number(rec.getLineItemValue('item', 'quantityfulfilled', x ) == 0)){
                thisId = rec.getLineItemValue('item','custcol_3rd_party_order_id',x);
                if(thisId != prevId){
                  orderIds.push(rec.getLineItemValue('item','custcol_3rd_party_order_id',x));
                }
                prevId = thisId;
              }
            }
          } 

          if(orderIds.length > 0) {
            for(var j = 0; j < orderIds.length; j++){
              var response = nlapiRequestURL(
                'https://overture.crea2print.com/json/order/' + orderIds[j],
                null,
                header,
                null,
                'GET'
              );
      
              var resCode = response.getCode();
              var resBody = response.getBody();
              var resBodyJson = JSON.parse(resBody);
  
              nlapiLogExecution('AUDIT','FARO Response',resBody);
  
              if(resCode == 200){
                var shippedStatus = resBodyJson.orderid[orderIds[j].toString()].statuscode;
                var carrierName = resBodyJson.orderid[orderIds[j].toString()].carrier_name;
                var shippingNumber = resBodyJson.orderid[orderIds[j].toString()].shipping_number;
                var stopBug = 'stop';
                //check status to see if its' 4 or 5
                if(shippedStatus == 4 || shippedStatus == 5){
                  var fulfillRecord = nlapiTransformRecord('salesorder', internalId, 'itemfulfillment');
                  fulfillRecord.setFieldText('shipstatus','Shipped');
                  for(var t = 1; t <= fulfillRecord.getLineItemCount('item'); t++){
                    if(fulfillRecord.getLineItemValue('item','custcol_3rd_party_order_id',t) == orderIds[j]){
                      fulfillRecord.setLineItemValue('item','itemreceive',t,'T');
                    }
                  }
                  if(shippingNumber != null && shippingNumber != ''){
                    fulfillRecord.selectNewLineItem('package');
                    fulfillRecord.setCurrentLineItemValue('package','packageweight','0.01');
                    fulfillRecord.setCurrentLineItemValue('package','packagetrackingnumber', shippingNumber);
                    fulfillRecord.setCurrentLineItemValue('package','packagedescr', carrierName);
                    fulfillRecord.commitLineItem('package');
                  }
  
                  var newFufillmentId =  nlapiSubmitRecord(fulfillRecord);
                  nlapiLogExecution('AUDIT','SUCCESS', newFufillmentId +' successfully Created');
                }
              }else{
                throw new nlapiCreateError('NOT_200','FARO Response was not 200');
              }
            }
          }
          else {
            nlapiLogExecution('AUDIT','No orderIds','No Lines Ready to Fulfill');
          }
          

          if(i % 10 == 0) {
            if(checkGovernance() == true) {
              break;
            }	
          }
        }
  
        catch(e) {
          var error = e.code+' :: '+e.message;
          nlapiLogExecution('ERROR','Try / Catch Error',error);
          nlapiSendEmail(
            '6',
            'jacobg@overturepromo.com',
            'Faro Error Main Try/Catch Error',
            error.toString(),
            null,
            null,
            null,
            null
          );
        }
      }
    }
  }
  
  